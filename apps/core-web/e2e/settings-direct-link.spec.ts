import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { elementsPastTheScreen, pageOverflow } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

/**
 * AUT-778: a direct /settings?tab=<section> link highlights its own tab (not Finanzen) and scrolls the tab strip so that
 * tab is visible, on a phone and on wider screens.
 */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const list = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

const TABS = [
  ['locations', deSettings.tabs.locations],
  ['labor', deSettings.tabs.labor],
  ['hours', deSettings.tabs.hours],
  ['api-keys', deSettings.tabs.apiKeys],
] as const

for (const width of [375, 390, 768, 1280]) {
  test.describe(`Settings direct links at ${width}px (AUT-778)`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const [tab, label] of TABS) {
      test(`?tab=${tab} highlights its tab and brings it into view`, async ({ page }) => {
        await page.route(/\/api\/(sites|margin-rules|audit-logs|locations)/, (route) => route.fulfill(json(list)))
        await new AutoCorePage(page, '').navigate(`/settings?tab=${tab}`)

        const strip = page.getByRole('tablist').first()
        const active = strip.getByRole('tab', { name: label, exact: true })
        await expect(active).toHaveAttribute('data-state', 'active')
        await expect(strip.getByRole('tab', { name: deSettings.tabs.finance, exact: true })).toHaveAttribute('data-state', 'inactive')
        await expect(strip.locator('[role="tab"][data-state="active"]')).toHaveCount(1)

        await expect
          .poll(async () => {
            const stripBox = (await strip.boundingBox())!
            const tabBox = (await active.boundingBox())!
            return tabBox.x >= stripBox.x - 1 && tabBox.x + tabBox.width <= stripBox.x + stripBox.width + 1
          }, { message: 'active tab inside the visible part of the strip' })
          .toBe(true)
        // The tab strip scrolls on its own; the page must not (the desktop shell width is not what this checks).
        if (width < 768) {
          expect(await elementsPastTheScreen(page), 'elements past the right edge').toEqual([])
          expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
        }
      })
    }
  })
}
