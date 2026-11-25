import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoPageScroll } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

/**
 * AUT-778 & AUT-1051: legacy /settings?tab=<section> links redirect to /settings/<section>
 * (preserving extra query params), unknown ?tab= / unknown paths redirect to /settings overview,
 * and non-admins are redirected from admin-only sections to /settings overview.
 */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const list = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

const REDIRECT_TABS = [
  ['locations', deSettings.tabs.locations],
  ['labor', deSettings.tabs.labor],
  ['hours', deSettings.tabs.hours],
  ['api-keys', deSettings.tabs.apiKeys],
] as const

for (const width of [375, 1280] as const) {
  test.describe(`Settings legacy ?tab= redirects at ${width}px (AUT-778 / AUT-1051)`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const [tab, label] of REDIRECT_TABS) {
      test(`?tab=${tab} redirects to /settings/${tab} and never renders tab strip or select`, async ({ page }, testInfo) => {
        await page.route(/\/api\/(margin-rules|audit-logs|locations|api-keys|labor)/, (route) => route.fulfill(json(list)))
        await page.route(/\/api\/sites(\?.*)?$/, (route) => route.fulfill(json([])))
        await new AutoCorePage(page, '').navigate(`/settings?tab=${tab}`)

        await expect(page).toHaveURL(new RegExp(`/settings/${tab}$`))
        await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
        await expect(page.getByTestId('settings-tab-strip')).toHaveCount(0)
        await expect(page.getByTestId('settings-section-select')).toHaveCount(0)
        await expectNoPageScroll(page)

        if (tab === 'hours') {
          await testInfo.attach(`settings-redirect-hours-${width}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          })
        }
      })
    }
  })
}

test.describe('Settings deep-link edge cases (AUT-1051)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('preserves extra query params when redirecting /settings?tab=data-import', async ({ page }, testInfo) => {
    await page.route(/\/api\/(vendors|data-import|margin-rules)/, (route) => route.fulfill(json(list)))
    await new AutoCorePage(page, '').navigate('/settings?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=vendor-42')

    await expect(page).toHaveURL(/\/settings\/data-import\?entity=SUPPLIER_PRICE_LIST&vendorId=vendor-42$/)
    await expect(page.getByRole('heading', { level: 1, name: deSettings.tabs.dataImport })).toBeVisible()
    await testInfo.attach('settings-redirect-data-import-params', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  for (const unknownPath of ['/settings?tab=does-not-exist', '/settings/does-not-exist']) {
    test(`unknown ${unknownPath} redirects to /settings overview, not finance`, async ({ page }, testInfo) => {
      await new AutoCorePage(page, '').navigate(unknownPath)

      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
      await expect(page.getByLabel(deSettings.finance.invoicing.prefix)).toHaveCount(0)
      if (unknownPath.includes('?tab=')) {
        await testInfo.attach('settings-redirect-unknown-to-overview', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }
    })
  }

  for (const adminPath of ['/settings/audit-logs', '/settings?tab=audit-logs']) {
    test(`non-admin opening ${adminPath} is redirected to /settings overview`, async ({ page }, testInfo) => {
      await page.addInitScript(() => window.localStorage.setItem('e2e-active-role', 'SALES'))
      await new AutoCorePage(page, '').navigate(adminPath)

      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
      await expect(page.getByLabel('Nach Objekttyp filtern')).toHaveCount(0)
      if (adminPath === '/settings/audit-logs') {
        await testInfo.attach('settings-redirect-non-admin-to-overview', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }
    })
  }
})
