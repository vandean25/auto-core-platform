import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoPageScroll } from './utils/phone-layout'

/** AUT-795: the estimates list works at 375px: rows, filters, load more with the cursor, a row opens the work order. */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const estimate = (n: number, overrides: Record<string, unknown> = {}) => ({
  version_id: `ver-${n}`,
  estimate_number: `KV-2026-000${n}`,
  version: 1,
  status: 'SENT',
  order_id: `order-${n}`,
  order_number: `WO-2026-000${n}`,
  customer_id: 'cust-1',
  customer_name: 'Muster Karosserie GmbH',
  vehicle_plate: 'W-123AB',
  sent_at: '2026-10-01T08:00:00.000Z',
  valid_until: '2026-10-15T08:00:00.000Z',
  decided_at: null,
  total_gross: '1234.50',
  ...overrides,
})

test.describe('Estimates list on a phone (AUT-795)', () => {
  test('shows rows, filters by status and loads more at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const requests: URL[] = []
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/estimates'), (route) => {
      const url = new URL(route.request().url())
      requests.push(url)
      const cursor = url.searchParams.get('cursor')
      if (url.searchParams.get('status') === 'APPROVED') {
        return route.fulfill(json({ data: [estimate(9, { status: 'APPROVED' })], meta: { page_size: 25, next_cursor: null } }))
      }
      return route.fulfill(
        json(
          cursor
            ? { data: [estimate(2)], meta: { page_size: 25, next_cursor: null } }
            : { data: [estimate(1)], meta: { page_size: 25, next_cursor: 'cursor-2' } },
        ),
      )
    })
    await new AutoCorePage(page, '').navigate('/workshop/estimates')

    const rows = page.locator('[data-table-row="true"]')
    await expect(rows).toHaveCount(1)
    expect(requests[0]!.searchParams.get('status')).toBe('SENT')
    await expect(rows.first()).toContainText('KV-2026-0001')
    await expect(rows.first()).toContainText('Muster Karosserie')
    await expectNoPageScroll(page)

    await page.getByRole('button', { name: 'Weitere laden' }).click()
    await expect(rows).toHaveCount(2)
    expect(requests.at(-1)!.searchParams.get('cursor')).toBe('cursor-2')
    await expect(page.getByRole('button', { name: 'Weitere laden' })).toHaveCount(0)

    await page.getByTestId('estimate-status-chip-APPROVED').click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('KV-2026-0009')
    await expectNoPageScroll(page)
  })

  test('the filter bar stays inside the screen and a row opens the work order', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/estimates'), (route) =>
      route.fulfill(json({ data: [estimate(1, { version: 2 })], meta: { page_size: 25, next_cursor: null } })),
    )
    await new AutoCorePage(page, '').navigate('/workshop/estimates')

    const filters = page.getByTestId('estimate-list-filters')
    await expect(filters).toBeVisible()
    for (const control of [
      page.getByRole('combobox', { name: 'Kunde' }),
      page.getByTestId('estimate-sent-from'),
      page.getByTestId('estimate-sent-to'),
      page.getByRole('checkbox', { name: 'Ältere Versionen anzeigen' }),
    ]) {
      const box = (await control.boundingBox())!
      expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(375)
    }
    await expectNoPageScroll(page)

    await page.locator('[data-table-row="true"]').first().click()
    await expect(page).toHaveURL(/\/workshop\/orders\/order-1#estimate-version-2$/)
  })
})
