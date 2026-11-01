import { expect, test, type Locator, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }
import deVehicles from '../../../locales/de/vehicles.json' with { type: 'json' }
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import { PHONE_WIDTHS } from './utils/phone-layout'

/**
 * AUT-791 / AUT-841: the search hint of a list is readable in full at 375 and 390 px.
 */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const emptyList = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

/** How many pixels of the placeholder text do not fit into the input (0 when it is fully readable). */
async function hiddenPlaceholderWidth(input: Locator): Promise<number> {
  return input.evaluate((node: HTMLInputElement) => {
    const style = getComputedStyle(node)
    const context = document.createElement('canvas').getContext('2d')!
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const textWidth = context.measureText(node.placeholder).width
    const room = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return Math.max(0, Math.ceil(textWidth - room))
  })
}

async function mockApi(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/audit-logs'), (route) => route.fulfill(json(emptyList)))
  await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock/gewaehrleistung-due'), (route) =>
    route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } })),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/estimates*'), (route) =>
    route.fulfill(json({ data: [], meta: { next_cursor: null } })),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/search*'), (route) =>
    route.fulfill(json({ data: { vehicles: [], customers: [] }, meta: { total: 0 } })),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), (route) => route.fulfill(json([])))
}

const LISTS = [
  ['Audit-Logs', '/settings?tab=audit-logs', deSettings.auditLogs.searchPlaceholder, 'audit-logs'],
  ['Gewährleistung fällig', '/vehicles/gewaehrleistung-due', deVehicles.gewaehrleistungDue.searchPlaceholder, 'gewaehrleistung-due'],
  ['Kostenvoranschläge', '/workshop/estimates', deWorkshop.estimateList.searchPlaceholder, 'estimates'],
  ['Annahme-Suche', '/workshop/intake', deWorkshop.intakeDashboard.searchPlaceholder, 'intake'],
] as const

for (const width of PHONE_WIDTHS) {
  test.describe(`Search hints at ${width}px (AUT-791 / AUT-841)`, () => {
    test.use({ viewport: { width, height: 812 } })

    for (const [name, path, placeholder, slug] of LISTS) {
      test(`${name}: the whole hint is readable`, async ({ page }) => {
        await mockApi(page)
        await new AutoCorePage(page, '').navigate(path)

        const input = page.getByPlaceholder(placeholder)
        await expect(input).toBeVisible()
        expect(await hiddenPlaceholderWidth(input), 'pixels of the hint that are cut off').toBe(0)

        if (width === 375 && (slug === 'estimates' || slug === 'intake')) {
          await page.screenshot({ path: `../../docs/internal/assets/aut-841-${slug}-search-375.png` })
        }
      })
    }
  })
}
