import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockVehicleListItem } from './utils/mock-factories'

/** AUT-807: the vehicle list on a phone fetches the first page and, when asked, the next one, and then goes quiet. */
const TOTAL_VEHICLES = 7200
const IDLE_MS = 12_000

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Serves a paged vehicle list like the API and records every list request it receives. */
async function mockVehicleList(page: Page) {
  const requests: URL[] = []
  await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const pageNumber = Number(url.searchParams.get('page') ?? 1)
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10)
    const first = (pageNumber - 1) * pageSize
    const count = Math.max(0, Math.min(pageSize, TOTAL_VEHICLES - first))
    const data = Array.from({ length: count }, (_, index) =>
      createMockVehicleListItem({ id: `veh-${first + index}`, make: 'Toyota', model: `Corolla ${first + index}`, plate: `W-${first + index}` }),
    )
    return route.fulfill(
      json({ data, meta: { total: TOTAL_VEHICLES, page: pageNumber, limit: pageSize, pageCount: Math.ceil(TOTAL_VEHICLES / pageSize) } }),
    )
  })
  return requests
}

/** The Pickerl due list: the API slices a long due list in memory, so a client that walks its pages is expensive. */
async function mockPickerlDueList(page: Page) {
  const requests: URL[] = []
  await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 25), 50)
    const data = Array.from({ length: pageSize }, (_, index) =>
      createMockVehicleListItem({ id: `veh-${index}`, plate: `W-${index}`, pickerl_due: { status: 'DUE_SOON', due_month: '2026-11' } } as never),
    )
    return route.fulfill(json({ data, meta: { total: TOTAL_VEHICLES, page: 1, pageSize, pageCount: Math.ceil(TOTAL_VEHICLES / pageSize) } }))
  })
  return requests
}

const pagesOf = (requests: URL[]) => requests.map((url) => Number(url.searchParams.get('page') ?? 1))

test.describe('Vehicle list idles quietly on a phone (AUT-807)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  for (const path of ['/vehicles', '/vehicles?pageSize=200']) {
    test(`${path}: only the first page is requested, also after idling and scrolling`, async ({ page }) => {
      const requests = await mockVehicleList(page)
      await new AutoCorePage(page, '').navigate(path)
      await expect(page.locator('[data-table-row="true"]').first()).toBeVisible()

      await page.mouse.wheel(0, 4000)
      await page.waitForTimeout(IDLE_MS)

      expect(pagesOf(requests), 'pages requested while idle').toEqual([1])
      expect(requests.every((url) => Number(url.searchParams.get('pageSize') ?? 10) <= 50), 'pageSize stays small').toBe(true)
    })
  }

  test('the Pickerl due list stays on its first page and asks for at most 50 rows', async ({ page }) => {
    const requests = await mockPickerlDueList(page)
    await new AutoCorePage(page, '').navigate('/vehicles/pickerl-due?pageSize=200')
    await expect(page.locator('[data-table-row="true"]').first()).toBeVisible()

    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(IDLE_MS)

    expect(pagesOf(requests), 'pages requested while idle').toEqual([1])
    expect(requests.every((url) => Number(url.searchParams.get('pageSize') ?? 25) <= 50), 'pageSize stays small').toBe(true)
  })

  test('the next page is requested once per click on Next', async ({ page }) => {
    const requests = await mockVehicleList(page)
    await new AutoCorePage(page, '').navigate('/vehicles')
    await expect(page.locator('[data-table-row="true"]').first()).toBeVisible()

    await page.getByRole('button', { name: 'Weiter' }).click()
    await expect(page.locator('[data-table-row="true"]').first()).toContainText('Corolla 10')
    await page.waitForTimeout(4000)

    expect(pagesOf(requests)).toEqual([1, 2])
  })
})
