import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { elementsPastTheScreen, pageOverflow } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

/**
 * AUT-778: a direct /settings?tab=<section> link opens its own section (not Finanzen): in the phone select below md,
 * and in the tab strip from md, which scrolls that tab into view.
 */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const list = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

const TABS = [
  ['locations', deSettings.tabs.locations],
  ['labor', deSettings.tabs.labor],
  ['hours', deSettings.tabs.hours],
  ['api-keys', deSettings.tabs.apiKeys],
] as const

const PHONE_WIDTHS_BELOW_MD = [375, 390]
const STRIP_WIDTHS = [768, 1280]

for (const width of PHONE_WIDTHS_BELOW_MD) {
  test.describe(`Settings direct links at ${width}px (AUT-778)`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const [tab, label] of TABS) {
      // On a phone the sections are one select (AUT-754); a direct link must show its own section there.
      test(`?tab=${tab} is the selected section and the page does not scroll sideways`, async ({ page }) => {
        await page.route(/\/api\/(sites|margin-rules|audit-logs|locations)/, (route) => route.fulfill(json(list)))
        await new AutoCorePage(page, '').navigate(`/settings?tab=${tab}`)

        await expect(page.getByTestId('settings-section-select')).toContainText(label)
        await expect(page.getByTestId('settings-section-select')).not.toContainText(deSettings.tabs.finance)
        await expect(page.getByTestId('settings-tab-strip')).toBeHidden()
        expect(await elementsPastTheScreen(page), 'elements past the right edge').toEqual([])
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
      })
    }
  })
}

for (const width of STRIP_WIDTHS) {
  test.describe(`Settings direct links at ${width}px (AUT-778)`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const [tab, label] of TABS) {
      test(`?tab=${tab} highlights its tab and brings it into view`, async ({ page }) => {
        await page.route(/\/api\/(sites|margin-rules|audit-logs|locations)/, (route) => route.fulfill(json(list)))
        await new AutoCorePage(page, '').navigate(`/settings?tab=${tab}`)

        const strip = page.getByTestId('settings-tab-strip')
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
      })
    }
  })
}
