import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockListResponse, createMockVehicleListItem } from './utils/mock-factories'
import { expectNoPageScroll } from './utils/phone-layout'

/** AUT-768: the Einstellungen > Team list on a phone shows who is who: name and e-mail as title, role below. */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const member = (id: string, firstName: string, lastName: string, role: string) => ({
  id,
  tenantId: 'tenant-1',
  userId: `user-${id}`,
  email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@werkstatt.example`,
  firstName,
  lastName,
  role,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

test.describe('Team list on a phone (AUT-768)', () => {
  for (const width of [375, 390]) {
    test(`rows show name, e-mail and role at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await page.route(AutoCorePage.apiRouteMatcher('/api/tenant-members'), (route) =>
        route.fulfill(json({ data: [member('m1', 'Anna', 'Muster', 'ADMIN'), member('m2', 'Tim', 'Techniker', 'TECH')], meta: { total: 2, page: 1, limit: 100, pageCount: 1 } })),
      )
      await new AutoCorePage(page, '').navigate('/settings?tab=team')

      const rows = page.locator('[data-table-row="true"]')
      await expect(rows).toHaveCount(2)
      await expect(rows.first()).toContainText('Anna Muster')
      await expect(rows.first()).toContainText('anna.muster@werkstatt.example')
      await expect(rows.first()).toContainText('ADMIN')
      await expect(rows.first()).toContainText('Aktiv')
      // Title above, role below it (not swapped), and the status badge does not touch the list border.
      const first = (await rows.first().boundingBox())!
      const role = (await rows.first().getByText('ADMIN').boundingBox())!
      const nameBox = (await rows.first().getByText('Anna Muster').boundingBox())!
      expect(role.y).toBeGreaterThan(nameBox.y)
      const badge = (await rows.first().getByText('Aktiv').boundingBox())!
      expect(first.x + first.width - (badge.x + badge.width), 'space right of the status badge').toBeGreaterThanOrEqual(10)
      await expect(rows.nth(1)).toContainText('Tim Techniker')
      await expectNoPageScroll(page)
    })
  }

  test('a member without a name shows the e-mail once', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.route(AutoCorePage.apiRouteMatcher('/api/tenant-members'), (route) =>
      route.fulfill(json({ data: [{ ...member('m3', 'Nameless', 'Person', 'SALES'), firstName: null, lastName: null, email: 'invited@werkstatt.example' }], meta: { total: 1, page: 1, limit: 100, pageCount: 1 } })),
    )
    await new AutoCorePage(page, '').navigate('/settings?tab=team')
    await expect(page.locator('[data-table-row="true"]').first()).toBeVisible()
    await expect(page.getByText('invited@werkstatt.example')).toHaveCount(1)
  })
})

test.describe('List row polish on a phone (AUT-768)', () => {
  test('Fahrzeuge: a long title wraps instead of being cut off and the trailing value is readable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), (route) =>
      route.fulfill(
        json(createMockListResponse([createMockVehicleListItem({ id: 'v1', make: 'Volkswagen', model: 'Multivan California Beach Camper', plate: '' })])),
      ),
    )
    await new AutoCorePage(page, '').navigate('/vehicles')

    const row = page.locator('[data-table-row="true"]').first()
    await expect(row).toBeVisible()
    const title = row.getByText(/Multivan California Beach Camper/)
    // The title wraps (up to two lines) instead of being cut off on one line.
    const titleBox = (await title.boundingBox())!
    expect(await title.evaluate((node) => getComputedStyle(node).whiteSpace), 'title does not wrap').not.toBe('nowrap')
    expect(titleBox.height, 'title spans two lines').toBeGreaterThan(30)
    expect(await title.evaluate((node) => node.scrollHeight - node.clientHeight), 'title clipped').toBeLessThanOrEqual(0)
    // The trailing value (plate, or "k. A." without one) is not tiny.
    const trailing = row.getByText('k. A.')
    await expect(trailing).toBeVisible()
    expect(await trailing.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14)
  })
})
