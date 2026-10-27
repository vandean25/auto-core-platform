import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

/** AUT-754: the settings sections are reachable on a phone, and empty states and tables fit 375/390px. */
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

test.describe('Settings navigation on a phone (AUT-754)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('a select lists every section and switches the tab; the strip is hidden', async ({ page }) => {
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/settings')

    const select = page.getByTestId('settings-section-select')
    await expect(select).toBeVisible()
    await expect(page.getByTestId('settings-tab-strip')).toBeHidden()
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(select).toContainText(deSettings.tabs.finance)

    await select.click()
    const options = page.getByRole('option')
    // All sections of an admin are in the list, including the ones the strip used to hide.
    await expect(options).toHaveCount(17)
    expect((await options.first().boundingBox())!.height, 'option height').toBeGreaterThanOrEqual(44)
    await options.filter({ hasText: deSettings.tabs.auditLogs }).click()

    await expect(page).toHaveURL(/tab=audit-logs/)
    await expect(select).toContainText(deSettings.tabs.auditLogs)
    await expect(page.getByLabel('Nach Objekttyp filtern')).toBeVisible()
    await expectNoPageScroll(page)
  })

  test('Esc closes the select and focus returns to it', async ({ page }) => {
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/settings')
    const select = page.getByTestId('settings-section-select')
    await select.click()
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(select).toBeFocused()
  })
})

test.describe('Settings tab strip on a laptop (AUT-754)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the strip is shown, the select is hidden and the active tab is scrolled into view', async ({ page }) => {
    await mockApi(page)
    await new AutoCorePage(page, '').navigate('/settings?tab=audit-logs')

    await expect(page.getByTestId('settings-section-select')).toBeHidden()
    const strip = page.getByTestId('settings-tab-strip')
    const active = strip.getByRole('tab', { name: deSettings.tabs.auditLogs })
    await expect(active).toHaveAttribute('data-state', 'active')
    const stripBox = (await strip.boundingBox())!
    const tabBox = (await active.boundingBox())!
    expect(tabBox.x).toBeGreaterThanOrEqual(stripBox.x - 1)
    expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1)
    // Only the strip scrolls, never the page.
    expect(await page.evaluate(() => window.scrollX), 'page scrolled sideways').toBe(0)
  })
})

test.describe('Empty states and tables on a phone (AUT-754)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`Margenregeln: the empty text is fully visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockApi(page)
      await new AutoCorePage(page, '').navigate('/settings?tab=margin-rules')

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
      await new AutoCorePage(page, '').navigate('/settings?tab=revenue-groups')

      const row = page.getByRole('listitem').filter({ hasText: 'Werkstattleistungen Arbeit' })
      await expect(row).toBeVisible()
      // Every field of the group is on screen: tax rate, account number and the default badge.
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
      await new AutoCorePage(page, '').navigate('/settings?tab=sites')

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
