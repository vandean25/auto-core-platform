import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

/** AUT-754 & AUT-1051: settings grouped overview, search, section subpages, and phone layout. */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const list = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

async function mockApi(page: Page) {
  await page.route(/\/api\/margin-rules(\/threshold)?(\?.*)?$/, (route) =>
    route.fulfill(json(route.request().url().includes('threshold') ? { thresholdPercent: 10 } : [])),
  )
  await page.route(/\/api\/vehicles\/pickerl-due/, (route) => route.fulfill(json(list)))
  await page.route(/\/api\/finance\/revenue-groups/, (route) =>
    route.fulfill(json([{ id: 'rg1', name: 'Werkstattleistungen Arbeit', tax_rate: 20, account_number: '4000', is_default: true }])),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/audit-logs'), (route) => route.fulfill(json(list)))
  await page.route(/\/api\/sites(\?.*)?$/, (route) =>
    route.fulfill(
      json([
        { id: 'site-1', tenant_id: 't', legal_entity_id: 'le-1', code: 'WIE', name: 'Wien', is_active: true, legal_entity: { id: 'le-1', name: 'Demo GmbH', country_iso: 'AT' }, _count: { memberships: 3, bays: 2, storageLocations: 4 } },
      ]),
    ),
  )
  await page.route(/\/api\/sites\/[^/]+\/memberships/, (route) => route.fulfill(json([])))
}

for (const width of [1280, 375] as const) {
  test.describe(`Settings overview and navigation at ${width}px (AUT-1051)`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('admin sees all 18 tiles in 4 groups, search filters them, and clicking a tile opens the subpage with breadcrumb', async ({ page }, testInfo) => {
      await mockApi(page)
      await new AutoCorePage(page, '').navigate('/settings')

      await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
      await expect(page.getByTestId('settings-section-select')).toHaveCount(0)

      const search = page.getByRole('searchbox', { name: deSettings.overview.searchLabel })
      await expect(search).toBeVisible()

      for (const groupId of ['company', 'workshop', 'finance', 'system']) {
        await expect(page.getByTestId(`settings-group-${groupId}`)).toBeVisible()
      }

      const tiles = page.locator('[data-testid^="settings-group-"] a')
      await expect(tiles).toHaveCount(18)

      if (width === 375) {
        const firstBox = (await tiles.first().boundingBox())!
        expect(firstBox.height).toBeGreaterThanOrEqual(44)
      }
      await expectNoPageScroll(page)

      await testInfo.attach(`settings-overview-admin-${width}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })

      if (width === 1280) {
        await search.fill('Hebebühnen')
        await expect(tiles).toHaveCount(1)
        await expect(page.getByTestId('settings-group-workshop')).toBeVisible()
        await expect(page.getByTestId('settings-group-company')).toHaveCount(0)
        await testInfo.attach('settings-overview-search-1280', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
        await search.fill('')
        await expect(tiles).toHaveCount(18)
      }

      await page.getByRole('link', { name: new RegExp(deSettings.tabs.hours) }).click()
      await expect(page).toHaveURL(/\/settings\/hours$/)
      await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
      await expect(page.getByTestId('settings-section-select')).toHaveCount(0)

      const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
      await expect(breadcrumb).toContainText(deSettings.page.title)
      await expect(breadcrumb).toContainText(deSettings.tabs.hours)
      await expect(page.getByRole('link', { name: deSettings.page.backToOverview })).toHaveAttribute('href', '/settings')
      await expectNoPageScroll(page)

      await testInfo.attach(`settings-subpage-hours-breadcrumb-${width}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    })
  })
}

test.describe('Settings overview non-admin visibility (AUT-1051)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('non-admin sees only non-admin tiles in their groups', async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.setItem('e2e-active-role', 'SALES'))
    await new AutoCorePage(page, '').navigate('/settings')

    const tiles = page.locator('[data-testid^="settings-group-"] a')
    await expect(tiles).toHaveCount(10)
    await expect(page.getByRole('link', { name: new RegExp(deSettings.tabs.auditLogs) })).toHaveCount(0)
    await expect(page.getByRole('link', { name: new RegExp(deSettings.tabs.team) })).toHaveCount(0)
    await testInfo.attach('settings-overview-non-admin-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})

test.describe('Empty states and tables on a phone (AUT-754)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`Margenregeln: the empty text is fully visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockApi(page)
      await new AutoCorePage(page, '').navigate('/settings/margin-rules')

      const empty = page.getByText(/Keine Margenregeln definiert/)
      await expect(empty).toBeVisible()
      const box = (await empty.boundingBox())!
      expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(width)
      expect(await empty.evaluate((node) => node.scrollWidth - node.clientWidth), 'text clipped').toBeLessThanOrEqual(0)
      await expectNoPageScroll(page)
    })

    test(`Erlösgruppen: one readable row per group at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockApi(page)
      await new AutoCorePage(page, '').navigate('/settings/revenue-groups')

      const row = page.getByRole('listitem').filter({ hasText: 'Werkstattleistungen Arbeit' })
      await expect(row).toBeVisible()
      await expect(row).toContainText('20%')
      await expect(row).toContainText('4000')
      await expect(row).toContainText(deSettings.revenueGroups.table.defaultBadge)
      const box = (await row.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await expectNoPageScroll(page)
    })

    test(`Standorte: one tappable row per site at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockApi(page)
      await new AutoCorePage(page, '').navigate('/settings/sites')

      const row = page.getByRole('button', { name: /WIE/ }).filter({ hasText: 'Wien' })
      await expect(row).toBeVisible()
      await expect(row).toContainText('Demo GmbH')
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await expectNoPageScroll(page)
    })
  }

  test('Pickerl fällig: the search field is full width so its hint is readable at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/vehicles/pickerl-due')
    const search = page.getByPlaceholder(/Suche in geladenen Zeilen/)
    await expect(search).toBeVisible()
    expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(320)
  })
})
