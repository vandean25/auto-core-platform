import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { controlsOutsideTheirCard, controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'

/** AUT-752: page content never widens the page at 375/390px; wide tables scroll inside their own container. */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const site = { id: 'site-1', code: 'WIE', name: 'Wien', legalEntityId: 'entity-1', legalEntityName: 'Demo GmbH' }

const kpiRow = (key: string, mechanic: string | null) => ({
  key,
  mechanic_id: mechanic ? key : null,
  mechanic_name: mechanic,
  period: '2026-10-01 – 2026-10-27',
  available_hours: '160.00',
  clocked_hours: '131.50',
  sold_hours: '142.25',
  labor_net_revenue: '12450.00',
  parts_net_revenue: '8120.50',
  utilisation_percent: '82.19',
  productivity_percent: '108.17',
  closed_orders: 38,
  average_net_revenue_per_order: '541.59',
  open_labor_entry_count: 2,
})
const kpiReport = {
  data: [kpiRow('m1', 'Max Mechaniker'), kpiRow('m2', 'Erika Werkstatt')],
  totals: kpiRow('total', null),
  meta: { from: '2026-10-01', to: '2026-10-27', timezone: 'Europe/Vienna', unassigned_mechanic_count: 0, groupBy: 'mechanic' },
  parts_turnover: {
    issued_cost: '9120.00',
    average_stock_value: '30400.00',
    turnover: '0.30',
    unvalued_stock_item_count: 0,
    slow_movers: [
      { catalog_item_id: 'c1', sku: 'BRK-0001', name: 'Bremsscheibe vorne Octavia III 288 mm belüftet', quantity_on_hand: '12.000', stock_value: '540.00', days_since_last_issue: 212 },
      { catalog_item_id: 'c2', sku: 'FLT-0042', name: 'Innenraumfilter mit Aktivkohle', quantity_on_hand: '40.000', stock_value: '320.00', days_since_last_issue: null },
    ],
  },
}

const openingHours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, isClosed: weekday >= 6, openTime: '07:30', closeTime: '17:00' }))
const holidays = [
  { id: 'h1', name: 'Staatsfeiertag', observedOn: '2026-05-01', repeatsAnnually: true, isClosed: true, source: 'IMPORTED' },
  { id: 'h2', name: 'Betriebsausflug Werkstatt', observedOn: '2026-06-12', repeatsAnnually: false, isClosed: false, openTime: '07:30', closeTime: '12:00', source: 'MANUAL' },
]

const locationTree = [
  {
    id: 'loc-1',
    name: 'Hauptlager Wien Simmering',
    code: 'WH-VIE-01',
    type: 'warehouse',
    children: [
      { id: 'loc-2', name: 'Regal Reifen und Räder Saisonware', code: 'A-01-REIFEN', type: 'shelf', children: [{ id: 'loc-3', name: 'Fach 12 Winterreifen Kundenlager Halle Nord', code: 'A-01-12-W-N3', type: 'bin', children: [] }] },
    ],
  },
]
const laborCategories = {
  data: [
    {
      id: 'lc-1',
      name: 'Fahrwerk und Federung',
      description: null,
      sort_order: 1,
      parent_id: null,
      default_hourly_rate: 95,
      is_active: true,
      children: [
        { id: 'lc-2', name: 'Radaufhängung und Stoßdämpfer vorne', description: null, sort_order: 1, parent_id: 'lc-1', default_hourly_rate: 95, is_active: true },
        { id: 'lc-3', name: 'Suspension Spezialwerkzeug', description: null, sort_order: 2, parent_id: 'lc-1', default_hourly_rate: null, is_active: false },
      ],
    },
  ],
}

async function mockApi(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations/tree'), (route) => route.fulfill(json(locationTree)))
  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), (route) => route.fulfill(json([])))
  await page.route(AutoCorePage.apiRouteMatcher('/api/labor/categories'), (route) => route.fulfill(json(laborCategories)))
  await page.route(AutoCorePage.apiRouteMatcher('/api/audit-logs'), (route) => route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } })))
  await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets'), (route) => route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } })))
  await page.route(AutoCorePage.apiRouteMatcher('/api/tyre-sets/due-for-swap'), (route) => route.fulfill(json({ data: [] })))
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), (route) =>
    route.fulfill(json({ timezone: 'Europe/Vienna', slotMinutes: 60, holidayCountryIso: 'AT', holidaySubdivisionCode: null, openingHours })),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/holidays'), (route) => route.fulfill(json({ data: holidays })))
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), (route) => route.fulfill(json([site])))
  await page.route(AutoCorePage.apiRouteMatcher('/api/reports/workshop-kpis'), (route) => route.fulfill(json(kpiReport)))
  await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), (route) =>
    route.fulfill(json([{ id: 'entity-1', name: 'Demo GmbH', code: 'DEMO', isActive: true }])),
  )
}

const PAGES = [
  ['Werkstatt-KPIs', '/workshop/reports/kpis'],
  ['Exportbereitschaft', '/finance/accounting-export-readiness'],
  ['Einstellungen: Öffnungszeiten', '/settings?tab=hours'],
  ['Einstellungen: Lagerorte', '/settings?tab=locations'],
  ['Einstellungen: Arbeit', '/settings?tab=labor'],
  ['Einstellungen: Audit-Logs', '/settings?tab=audit-logs'],
  ['Reifenlager', '/workshop/tyre-storage'],
] as const

test.describe('Page content on a phone (AUT-752)', () => {
  for (const width of PHONE_WIDTHS) {
    for (const [name, path] of PAGES) {
      test(`${name} fits at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 812 })
        await mockApi(page)
        await new AutoCorePage(page, '').navigate(path)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        await page.waitForTimeout(500)

        await expectNoPageScroll(page)
        await testInfo.attach(`${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      })
    }
  }

  for (const width of PHONE_WIDTHS) {
    test(`Werkstatt-KPIs tables scroll inside their card at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockApi(page)
      await new AutoCorePage(page, '').navigate('/workshop/reports/kpis')
      await expect(page.getByText('BRK-0001')).toBeVisible()

      for (const table of await page.locator('main table').all()) {
        const scroller = table.locator('xpath=ancestor::*[contains(@class,"overflow-x-auto")][1]')
        const box = await scroller.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
        // Wide tables keep their natural width and scroll inside the card; the page itself does not move.
        expect(box.scroll, 'table scrolls inside its container').toBeGreaterThan(box.client)
      }
      // Article names stay on one line instead of wrapping to five.
      const row = page.getByRole('row', { name: /BRK-0001/ })
      expect((await row.boundingBox())!.height).toBeLessThan(60)
      // The time zone is not shown HTML-escaped.
      await expect(page.getByText(/Zeitzone: Europe\/Vienna/)).toBeVisible()
      const content = page.getByRole('heading', { level: 1 }).locator('xpath=ancestor::div[contains(@class,"space-y-6")][1]')
      expect(await controlsShorterThan44(content), 'controls under 44px').toEqual([])
      await expectNoPageScroll(page)
    })
  }

  // Content QA found cut off or squeezed on a phone (release-1 comment): names stay readable, filters fit their card.
  test('Lagerorte: names and code badges are not squeezed or wrapped at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/settings?tab=locations')
    const badge = page.getByText('A-01-12-W-N3', { exact: true })
    await expect(badge).toBeVisible()
    expect((await badge.boundingBox())!.height, 'code badge on one line').toBeLessThan(26)
    const name = page.locator('span', { hasText: /^Fach 12 Winterreifen Kundenlager Halle Nord$/ })
    expect(await name.evaluate((node) => node.scrollWidth - node.clientWidth), 'name clipped').toBeLessThanOrEqual(0)
    await expectNoPageScroll(page)
  })

  test('Arbeit: category names are not cut off at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/settings?tab=labor')
    for (const name of ['Radaufhängung und Stoßdämpfer vorne', 'Suspension Spezialwerkzeug']) {
      const label = page.getByRole('button', { name, exact: true })
      await expect(label).toBeVisible()
      expect(await label.evaluate((node) => getComputedStyle(node).textOverflow), `${name} is ellipsized`).not.toBe('ellipsis')
      expect(await label.evaluate((node) => node.scrollWidth - node.clientWidth), `${name} clipped`).toBeLessThanOrEqual(0)
    }
    await expectNoPageScroll(page)
  })

  test('Audit-Logs: the filters fit their card at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/settings?tab=audit-logs')
    const entityType = page.getByLabel('Nach Objekttyp filtern')
    await expect(entityType).toBeVisible()
    expect(await controlsOutsideTheirCard(page.locator('main'))).toEqual([])
    expect((await entityType.boundingBox())!.width, 'filter is full width').toBeGreaterThan(250)
    await expectNoPageScroll(page)
  })

  test('Reifenlager: the filters take two columns, not two screens, at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/workshop/tyre-storage')
    const season = page.locator('label', { hasText: /^Saison$/ })
    const status = page.locator('label', { hasText: /^Status$/ })
    await expect(season).toBeVisible()
    expect((await season.boundingBox())!.y, 'season and status share a row').toBe((await status.boundingBox())!.y)
    const lastFilter = page.locator('label', { hasText: /^Fällig bis$/ })
    expect((await lastFilter.boundingBox())!.y, 'all filters within the first screen').toBeLessThan(812)
    await expectNoPageScroll(page)
  })
})
